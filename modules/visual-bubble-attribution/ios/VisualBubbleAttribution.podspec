Pod::Spec.new do |s|
  s.name = 'VisualBubbleAttribution'
  s.version = '1.0.0'
  s.summary = 'On-device visual sampling for message-bubble attribution.'
  s.description = s.summary
  s.homepage = 'https://wingr.app'
  s.license = { :type => 'UNLICENSED' }
  s.author = { 'Wingr' => 'support@wingr.app' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.9'
  s.source = { :git => 'https://example.invalid/wingr/visual-bubble-attribution.git', :tag => s.version.to_s }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
