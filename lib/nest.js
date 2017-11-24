'use strict';

const https = require('https');
const querystring = require('querystring');
const EventEmitter = require('events');
const NestCam = require('./nestcam').NestCam;

const NestAPIHostname = 'webapi.camera.home.nest.com';

class NestAPI extends EventEmitter {
  constructor(username, password) {
    super();
    let self = this;
    self.username = username;
    self.password = password;

    setInterval(() => {
      self._fetchSessionToken();
    }, 43200000);
  }

  _fetchSessionToken() {
    let self = this;
    let requestBody = querystring.stringify({
      username: self.username,
      password: self.password
    });
    self.sendHomeRequest('/api/v1/login.login', 'POST', requestBody)
      .then((response) => {
        let text = response.toString();
        let json = JSON.parse(text);
        if (json.status === 0 && json.items.length >= 1) {
          let item = json.items[0];
          let sessionToken = item.session_token;
          self.sessionToken = sessionToken;
        } else {
          console.log('[NestCam]Failed to request access token. ' + json.status_detail);
        }
      })
      .catch((err) => {
        console.log('[NestCam]Failed to request access token. ' + err.message);
      });
  }

  fetchSessionTokenAndUpdateCameras() {
    let self = this;
    let requestBody = querystring.stringify({
      username: self.username,
      password: self.password
    });
    self.sendHomeRequest('/api/v1/login.login', 'POST', requestBody)
      .then((response) => {
        let text = response.toString();
        let json = JSON.parse(text);
        if (json.status === 0 && json.items.length >= 1) {
          let item = json.items[0];
          let sessionToken = item.session_token;
          self.sessionToken = sessionToken;
          self.fetchCameras();
        } else {
          console.log('[NestCam]Failed to request access token. ' + json.status_detail);
        }
      })
      .catch((err) => {
        console.log('[NestCam]Failed to request access token. ' + err.message);
      });
  }

  fetchCameras() {
    let self = this;
    self.sendHomeRequest('/api/v1/cameras.get_visible', 'GET')
      .then((response) => {
        let text = response.toString();
        let json = JSON.parse(text);
        if (json.status === 0) {
          var cameras = [];
          json.items.forEach((cameraInfo) => {
            let camera = new NestCam(self, cameraInfo);
            cameras.push(camera);
          });
          self.emit('cameras', cameras);
        } else {
          console.log('[NestCam]Failed to load cameras. ' + json.status_detail);
        }
      })
      .catch((err) => {
        console.log('[NestCam]Failed to load cameras. ' + err.message);
      });
  }

  sendHomeRequest(endpoint, method, body) {
    let self = this;
    return self.sendRequest(NestAPIHostname, endpoint, method, body);
  }

  sendRequest(hostname, endpoint, method, body) {
    let self = this;

    return new Promise((resolve, reject) => {
      let headers = {
        'User-Agent': 'iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin'
      };
      
      if (method === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      }

      if (self.sessionToken !== undefined) {
        headers['Cookie'] = 'website_2=' + self.sessionToken;
      }

      let options = {
        hostname: hostname,
        path: endpoint,
        method: method,
        headers: headers
      };
      let req = https.request(options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('Unexpected API Error - ' + res.statusCode));
        }

        const resBody = [];
        res.on('data', (chunk) => resBody.push(chunk));
        res.on('end', () => resolve(Buffer.concat(resBody)));
      });
      req.on('error', (err) => reject(err));
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }
}

module.exports = {
  NestAPI: NestAPI
};