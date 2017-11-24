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
      "password": ""
    }
    
