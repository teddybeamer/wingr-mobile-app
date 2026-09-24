const {
  withPodfile,
  withPodfileProperties,
} = require('@expo/config-plugins');

const IOS_DEPLOYMENT_TARGET = '15.1';
const MARKER = '# WiNGR Xcode 27 iOS deployment-target override';

function addPodDeploymentTargetOverride(contents) {
  if (contents.includes(MARKER)) return contents;

  const targetEnd = '\n  end\nend\n';
  const insertionIndex = contents.lastIndexOf(targetEnd);
  if (insertionIndex < 0) {
    throw new Error('Could not find the end of the Podfile target block.');
  }

  const override = `

    ${MARKER}
    # Xcode 27 requires every generated Pod target to target iOS 15 or later.
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${IOS_DEPLOYMENT_TARGET}'
      end
    end`;

  return (
    contents.slice(0, insertionIndex) +
    override +
    contents.slice(insertionIndex)
  );
}

function withWingrIosDeploymentTarget(config) {
  config = withPodfileProperties(config, (config) => {
    config.modResults['ios.deploymentTarget'] = IOS_DEPLOYMENT_TARGET;
    return config;
  });

  return withPodfile(config, (config) => {
    config.modResults.contents = addPodDeploymentTargetOverride(
      config.modResults.contents,
    );
    return config;
  });
}

module.exports = withWingrIosDeploymentTarget;
module.exports.addPodDeploymentTargetOverride = addPodDeploymentTargetOverride;
