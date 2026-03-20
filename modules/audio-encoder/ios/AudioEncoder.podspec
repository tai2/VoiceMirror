require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioEncoder'
  s.version        = package['version']
  s.summary        = 'Native AAC encoder module for VoiceMirror'
  s.author         = 'VoiceMirror'
  s.homepage       = 'https://github.com/tai2/VoiceMirror'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.frameworks = 'AudioToolbox'
  s.source_files = '**/*.{h,m,swift}'
end
