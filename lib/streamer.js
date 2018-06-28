'use strict';

const crypto = require('crypto');
const tls = require('tls');
const pbf = require('pbf');
const EventEmitter = require('events');
const ip = require('ip');
const spawn = require('child_process').spawn;

const StreamProfile = require('./StreamProfile.js').StreamProfile;
const PlaybackPacket = require('./PlaybackPacket.js').PlaybackPacket;
const PlaybackBegin = require('./PlaybackBegin.js').PlaybackBegin;
const Redirect = require('./Redirect.js').Redirect;
const StartPlayback = require('./StartPlayback.js').StartPlayback;
const Hello = require('./Hello.js').Hello;

class NexusStreamer extends EventEmitter {
  constructor(host, cameraUUID, sessionToken, useOMX) {
    super();
    let self = this;
    self.isStreaming = false;
    self.authorized = false;
    self.useOMX = useOMX;
    self.sessionID = Math.floor(Math.random() * 100);
    self.host = host;
    self.cameraUUID = cameraUUID;
    self.sessionToken = sessionToken;
  }

  startPlaybackWithRequest(request) {
    let self = this;

    if (self.isStreaming) {
      console.log('Streamer is currently streaming!!!');
      return;
    }

    self.isStreaming = true;
    self.setupFFMPEGPipe(request);
    self.requestStartPlayback();
  }

  stopPlayback() {
    let self = this;

    if (!self.isStreaming) {
      return;
    }

    self.unschedulePingMessage();

    if (self.ffmpeg) {
      self.ffmpeg.kill('SIGKILL');
      self.ffmpeg = undefined;
    }
    self.isStreaming = false;
    self.socket.end();
    self.socket = undefined;
  }

  // Internal

  setupConnection() {
    let self = this;

    if (self.socket) {
      self.unschedulePingMessage();
      self.socket.end();
      self.socket = undefined;
    }

    let options = {
      host: self.host,
      port: 1443
    };
    self.socket = tls.connect(options, () => {
      console.log('[NexusStreamer]Connected');
      self.requestHello();
    });

    self.socket.on('data', (data) => {
      self.handleNexusData(data);
    });

    self.socket.on('end', () => {
      self.unschedulePingMessage();
      console.log('[NexusStreamer]Connection Closed');
    });
  }

  _processPendingMessages() {
    let self = this;
    if (self.pendingMessages) {
      let messages = self.pendingMessages;
      self.pendingMessages = undefined;
      messages.forEach((message) => {
        self._sendMessage(message.type, message.buffer);
      });
    }
  }

  _sendMessage(type, buffer) {
    let self = this;

    if (self.socket.connecting || !self.socket.encrypted) {
      // console.log('waiting for socket to connect');
      if (!self.pendingMessages) {
        self.pendingMessages = [];
      }
      self.pendingMessages.push({
        type: type,
        buffer: buffer
      });
      return;
    }

    if (type !== 100 && !self.authorized) {
      // console.log('waiting for authorization');
      if (!self.pendingMessages) {
        self.pendingMessages = [];
      }
      self.pendingMessages.push({
        type: type,
        buffer: buffer
      });
      return;
    }

    let requestBuffer;
    if (type === 0xCD) {
      requestBuffer = Buffer.alloc(5);
      requestBuffer[0] = type;
      requestBuffer.writeUInt32BE(buffer.length, 1);
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(buffer)]);
    } else {
      requestBuffer = Buffer.alloc(3);
      requestBuffer[0] = type;
      requestBuffer.writeUInt16BE(buffer.length, 1);
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(buffer)]);
    }
    self.socket.write(requestBuffer);
  }

  // Ping

  sendPingMessage() {
    let self = this;
    self._sendMessage(1, Buffer.alloc(0));
  }

  schedulePingMessage() {
    let self = this;
    
    if (self.pingInterval) {
      return;
    }

    self.pingInterval = setInterval(() => {
      self.sendPingMessage();
    }, 15000);
  }

  unschedulePingMessage() {
    let self = this;

    let interval = self.pingInterval;
    if (!interval) {
      return;
    }
    
    self.pingInterval = undefined;
    clearInterval(interval);
  }

  requestHello() {
    let self = this;
    let request = {
      protocol_version: Hello.ProtocolVersion.VERSION_3,
      uuid: self.cameraUUID,
      require_connected_camera: true,
      session_token: self.sessionToken,
      user_agent: 'iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin'
    };
    let pbfContainer = new pbf();
    Hello.write(request, pbfContainer);
    let buffer = pbfContainer.finish();
    self._sendMessage(100, buffer);
  }

  requestStartPlayback() {
    let self = this;
    let request = {
      session_id: self.sessionID,
      profile: StreamProfile.AVPROFILE_HD_MAIN_1,
      other_profiles: [
        StreamProfile.VIDEO_H264_2MBIT_L40,
        StreamProfile.VIDEO_H264_530KBIT_L31,
        StreamProfile.AVPROFILE_MOBILE_1,
        StreamProfile.AVPROFILE_HD_MAIN_1
      ],
      profile_not_found_action: StartPlayback.ProfileNotFoundAction.REDIRECT
    };
    let pbfContainer = new pbf();
    StartPlayback.write(request, pbfContainer);
    let buffer = pbfContainer.finish();
    self._sendMessage(103, buffer);
  }

  handleRedirect(payload) {
    let self = this;
    let packet = Redirect.read(payload);
    if (packet.new_host) {
      console.log("[NexusStreamer]Redirecting...");
      self.host = packet.new_host;
      self.setupConnection();
      self.requestStartPlayback();
    }
  }

  handlePlaybackBegin(payload) {
    let self = this;
    let packet = PlaybackBegin.read(payload);

    if (packet.session_id !== self.sessionID) {
      return;
    }

    for (let i = 0; i < packet.channels.length; i++) {
      var stream = packet.channels[i];
      if (stream.codec_type == 2) {
        self.videoChannelID = stream.channel_id;
      } else if (stream.codec_type == 3 || stream.codec_type == 4) {
        self.audioChannelID = stream.channel_id;
      }
    }
  }

  handlePlaybackPacket(payload) {
    let self = this;
    let packet = PlaybackPacket.read(payload);
    if (packet.channel_id === self.videoChannelID) {
      if (!self.ffmpeg) {
        return;
      }
      self.ffmpeg.stdin.write(Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), Buffer.from(packet.payload)]));
    }
  }

  handleNexusPacket(type, payload) {
    let self = this;
    switch(type) {
      case 1:
        console.log('[NexusStreamer]Ping');
        break;
      case 200:
        console.log('[NexusStreamer]OK');
        self.authorized = true;
        self._processPendingMessages();
        self.schedulePingMessage();
        break;
      case 201:
        console.log('[NexusStreamer]Error');
        self.stopPlayback();
        break;
      case 202:
        console.log('[NexusStreamer]Playback Begin');
        self.handlePlaybackBegin(payload);
        break;
      case 203:
        console.log('[NexusStreamer]Playback End');
        break;
      case 204:
        // console.log('[NexusStreamer]Playback Packet');
        self.handlePlaybackPacket(payload);
        break;
      case 205:
        // console.log('[NexusStreamer]Long Playback Packet');
        self.handlePlaybackPacket(payload);
        break;
      case 206:
        console.log('[NexusStreamer]Clock Sync');
        break;
      case 207:
        console.log('[NexusStreamer]Redirect');
        self.handleRedirect(payload);
        break;
      default:
        console.log('[NexusStreamer]Unhandled Type: ' + type);
    }
  }

  handleNexusData(data) {
    let self = this;
    if (self.pendingBuffer === undefined) {
      self.pendingBuffer = data;
    } else {
      self.pendingBuffer = Buffer.concat([self.pendingBuffer, data]);
    }

    const type = self.pendingBuffer.readUInt8();
    var headerLength = 0;
    var length = 0;
    if (type === 205) {
      headerLength = 5;
      length = self.pendingBuffer.readUInt32BE(1);
    } else {
      headerLength = 3;
      length = self.pendingBuffer.readUInt16BE(1);
    }
    var payloadEndPosition = length + headerLength;
    if (self.pendingBuffer.length >= payloadEndPosition) {
      const rawPayload = self.pendingBuffer.slice(headerLength, payloadEndPosition);
      const payload = new pbf(rawPayload);
      self.handleNexusPacket(type, payload);
      const remainingData = self.pendingBuffer.slice(payloadEndPosition);
      self.pendingBuffer = undefined;
      if (remainingData.length != 0) {
        self.handleNexusData(remainingData);
      }
    }
  }

  // HAP Streaming

  prepareStream(request, callback) {
    let self = this;
    self.setupConnection();

    let sessionInfo = {};
    let targetAddress = request['targetAddress'];
    sessionInfo['address'] = targetAddress;

    let response = {};

    let videoInfo = request['video'];
    if (videoInfo) {
      let targetPort = videoInfo['port'];
      let srtp_key = videoInfo['srtp_key'];
      let srtp_salt = videoInfo['srtp_salt'];

      // SSRC is a 32 bit integer that is unique per stream
      let ssrcSource = crypto.randomBytes(4);
      ssrcSource[0] = 0;
      let ssrc = ssrcSource.readInt32BE(0, true);

      let videoResp = {
        port: targetPort,
        ssrc: ssrc,
        srtp_key: srtp_key,
        srtp_salt: srtp_salt
      };

      response['video'] = videoResp;

      sessionInfo['video_port'] = targetPort;
      sessionInfo['video_srtp'] = Buffer.concat([srtp_key, srtp_salt]);
      sessionInfo['video_ssrc'] = ssrc; 
    }

    let audioInfo = request['audio'];
    if (audioInfo) {
      let targetPort = audioInfo['port'];
      let srtp_key = audioInfo['srtp_key'];
      let srtp_salt = audioInfo['srtp_salt'];

      // SSRC is a 32 bit integer that is unique per stream
      let ssrcSource = crypto.randomBytes(4);
      ssrcSource[0] = 0;
      let ssrc = ssrcSource.readInt32BE(0, true);

      let audioResp = {
        port: targetPort,
        ssrc: ssrc,
        srtp_key: srtp_key,
        srtp_salt: srtp_salt
      };

      response['audio'] = audioResp;

      sessionInfo['audio_port'] = targetPort;
      sessionInfo['audio_srtp'] = Buffer.concat([srtp_key, srtp_salt]);
      sessionInfo['audio_ssrc'] = ssrc; 
    }

    let currentAddress = ip.address();
    let addressResp = {
      address: currentAddress
    };

    if (ip.isV4Format(currentAddress)) {
      addressResp['type'] = 'v4';
    } else {
      addressResp['type'] = 'v6';
    }

    response['address'] = addressResp;
    self.sessionInfo = sessionInfo;

    callback(response);
  }

  setupFFMPEGPipe(request) {
    let self = this;
    let sessionInfo = self.sessionInfo;

    if (sessionInfo) {
      let width = 1280;
      let height = 720;
      let fps = 30;
      let bitrate = 300;

      let videoInfo = request['video'];
      if (videoInfo) {
        width = videoInfo['width'];
        height = videoInfo['height'];

        let expectedFPS = videoInfo['fps'];
        if (expectedFPS < fps) {
          fps = expectedFPS;
        }

        bitrate = videoInfo['max_bit_rate'];
      }

      let targetAddress = sessionInfo['address'];
      let targetVideoPort = sessionInfo['video_port'];
      let videoKey = sessionInfo['video_srtp'];
      let videoSsrc = sessionInfo["video_ssrc"];

      let ffmpegCodec = self.useOMX ? 'h264_omx' : 'libx264';

      let ffmpegCommand = '-i - -vcodec ' + ffmpegCodec + ' -an -pix_fmt yuv420p -r '+ fps +' -f rawvideo -x264-params "intra-refresh=1:bframes=0" -vf scale='+ width +':'+ height +' -b:v '+ bitrate +'k -payload_type 99 -ssrc '+ videoSsrc +' -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params '+videoKey.toString('base64')+' srtp://'+targetAddress+':'+targetVideoPort+'?rtcpport='+targetVideoPort+'&localrtcpport='+targetVideoPort+'&pkt_size=188';
      let ffmpeg = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});
      ffmpeg.stdin.on('error', (e) => {
        if (e.code !== 'EPIPE') {
          console.log(e.code);
        }
        self.stopPlayback();
      });
      self.ffmpeg = ffmpeg;
    }
  }
}

module.exports = {
  NexusStreamer: NexusStreamer
};