// The app's offline database and photos stay out of iCloud and computer backups (wave 16, E38-15).
// Files in an app's Documents folder are backed up by default; the folders the app keeps offline work
// in (Documents/SQLite, Documents/offline) are marked excluded, which covers everything put in them
// later. Called from mobile/src/offline/backup.ts.
import ExpoModulesCore
import Foundation

public class SandpiperStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SandpiperStorage")

    // Marks a file or folder (a file:// address or a path) excluded from backups. Answers false when it
    // does not exist yet; throws when the mark cannot be set.
    Function("excludeFromBackup") { (address: String) throws -> Bool in
      var url: URL
      if let parsed = URL(string: address), parsed.isFileURL {
        url = parsed
      } else {
        url = URL(fileURLWithPath: address)
      }
      guard FileManager.default.fileExists(atPath: url.path) else {
        return false
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return true
    }

    // Whether a file or folder is excluded from backups (for checks on a device).
    Function("isExcludedFromBackup") { (address: String) throws -> Bool in
      let url = URL(string: address).flatMap { $0.isFileURL ? $0 : nil } ?? URL(fileURLWithPath: address)
      return try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
    }
  }
}
