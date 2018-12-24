'use strict';

let Accessory, hap, UUIDGen;
const Nest = require('./lib/nest').NestAPI;

module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory;
  hap = homebridge.hap;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform('homebridge-nest-cam', 'Nest-cam', NestCamPlatform, true);
}

class NestCamPlatform {
  constructor(log, config, api) {
    let self = this;
    self.log = log;
    self.config = config || {};
    if (api) {
      self.api = api;
      if (api.version < 2.1) {
        throw new Error('Unexpected API version.');
      }

      self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
    }
  }

  configureAccessory(accessory) {
    // Won't be invoked
  }

  didFinishLaunching() {
    let self = this;
    let accessToken = self.config['access_token'];
    if ( typeof accessToken == 'undefined' || accessToken )
    {
      throw new Error('access_token is not defined in the Homebridge config');
    }
     self.nestAPI = new Nest(accessToken);
    self.nestAPI.on('cameras', (cameras) => {
      let configuredAccessories = [];
      cameras.forEach((camera) => {
        camera.configureWithHAP(hap, self.config.useOMX);
        let name = camera.name;
        let uuid = UUIDGen.generate(camera.uuid);
        let accessory = new Accessory(name, uuid, hap.Accessory.Categories.CAMERA);
        self.log('Create camera - ' + name);
        accessory.configureCameraSource(camera);
        configuredAccessories.push(accessory);
      });
      self.api.publishCameraAccessories('Nest-cam', configuredAccessories);
    });
    self.nestAPI.fetchSessionTokenAndUpdateCameras();
  }
}
