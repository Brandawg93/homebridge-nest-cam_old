# homebridge-nest-cam

Use your Nest Cam as IP camera in HomeKit with [Homebridge](https://github.com/nfarina/homebridge).

## Installation

1. Install ffmpeg
2. Install this plugin using: npm install -g homebridge-nest-cam
3. Edit ``config.json`` and add the camera.
3. Run Homebridge
4. Add extra camera accessories in Home app. The setup code is the same as homebridge.

### Config.json Example

    {
      "platform": "Nest-cam",
      "username": "",
      "password": "",
      "useOMX": false,
    }
    
On Raspberry Pi you might want to use OMX for transcoding as CPU on the board is too slow. In that case, make sure the ffmpeg you installed has `h264_omx` support. There are [pre-compiled deb](https://github.com/legotheboss/homebridge-camera-ffmpeg-omx) online if you don't want to compile one yourself.