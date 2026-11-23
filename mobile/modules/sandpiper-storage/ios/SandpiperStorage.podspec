# SandpiperStorage: keeps the app's offline work out of iPhone backups (wave 16, E38-15). A local Expo
# module (autolinked from mobile/modules/), iPhone only; Android's backup rules are in
# mobile/plugins/withPlatformSecurity.js. No dependency beyond Expo's module core.
Pod::Spec.new do |s|
  s.name           = 'SandpiperStorage'
  s.version        = '0.1.0'
  s.summary        = 'Excludes the app\'s offline database and photos from iCloud and computer backups'
  s.description    = 'Sets the excluded-from-backup resource value on the folders where Sandpiper GRC keeps offline work.'
  s.license        = 'MIT'
  s.author         = 'Sandpiper GRC contributors'
  s.homepage       = 'https://github.com/mdcrowley/sandpiper-grc'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/mdcrowley/sandpiper-grc.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
