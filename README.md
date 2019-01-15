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
      "access_token": "",
      "ffmpegCodec": "libx264"
    }

On Raspberry Pi you might want to use OMX for transcoding as CPU on the board is too slow. In that case, make sure the ffmpeg you installed has `h264_omx` support and set `ffmpegCodec` above to `h264_omx`. There are [pre-compiled deb](https://github.com/legotheboss/homebridge-camera-ffmpeg-omx) online if you don't want to compile one yourself.

On MacOS you might want to use VideoToolbox hardware acceleration for transcoding. In that case, make sure the ffmpeg you installed has `videotoolbox` support and set `ffmpegCodec` to `h264_videotoolbox`.

### How to get Access Token?

You can get access token from your Nest account by running the following command in terminal. If your account does not have 2FA enabled, you should be able to see `access_token` in the response.

```
curl -X "POST" "https://home.nest.com/session" \
     -H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
     -H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
     --data-urlencode "email=YOUR_NEST_EMAIL" \
     --data-urlencode "password=YOUR_PASSWORD"
```

If your account has 2FA enabled, after running the command above, you should see a `2fa_token` in the response, use that and the code you received from SMS to make the second request. If success, you should see `access_token` in the response.

```
curl -X "POST" "https://home.nest.com/api/0.1/2fa/verify_pin" \
     -H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{"pin": "CODE_FROM_SMS","2fa_token": "TOKEN_FROM_PRIOR_REQUEST"}'
```
