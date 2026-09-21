const fs = require('fs');
const path = require('path');
const {
  withDangerousMod,
  withXcodeProject,
} = require('expo/config-plugins');

const SWIFT_SOURCE = `import DeviceCheck
import React

@objc(WingrDeviceCheck)
class WingrDeviceCheck: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc
  func generateToken(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard DCDevice.current.isSupported else {
      reject(
        "ERR_DEVICECHECK_UNSUPPORTED",
        "DeviceCheck is unavailable on this device.",
        nil
      )
      return
    }

    DCDevice.current.generateToken { token, error in
      if let error {
        reject("ERR_DEVICECHECK_TOKEN", "Could not verify this device.", error)
        return
      }
      guard let token else {
        reject("ERR_DEVICECHECK_TOKEN", "Could not verify this device.", nil)
        return
      }
      resolve(token.base64EncodedString())
    }
  }
}
`;

const OBJECTIVE_C_SOURCE = `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WingrDeviceCheck, NSObject)

RCT_EXTERN_METHOD(
  generateToken:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)

@end
`;

function withWingrDeviceCheck(config) {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const sourceDirectory = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
      );
      fs.writeFileSync(path.join(sourceDirectory, 'WingrDeviceCheck.swift'), SWIFT_SOURCE);
      fs.writeFileSync(path.join(sourceDirectory, 'WingrDeviceCheck.m'), OBJECTIVE_C_SOURCE);
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget();
    const group = project.findPBXGroupKey({ name: config.modRequest.projectName });
    if (!group) {
      throw new Error('Could not find the iOS app group for WingrDeviceCheck.');
    }

    for (const filename of ['WingrDeviceCheck.swift', 'WingrDeviceCheck.m']) {
      if (
        !project.hasFile(filename) &&
        !project.hasFile(`${config.modRequest.projectName}/${filename}`)
      ) {
        project.addSourceFile(filename, { target: target.uuid }, group);
      }
    }
    return config;
  });
}

module.exports = withWingrDeviceCheck;
