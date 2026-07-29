import Foundation
import RalphyMediaCore

struct AppSettings {
    private enum Key {
        static let lastRoot = "lastRalphyRoot"
        static let gridSize = "mediaGridSize"
        static let bucket = "mediaBucket"
        static let sort = "mediaSort"
        static let group = "mediaGroup"
        static let includeIntermediates = "includeMediaIntermediates"
        static let inspectorVisible = "mediaInspectorVisible"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var lastRoot: URL? {
        get {
            defaults.string(forKey: Key.lastRoot).map {
                URL(filePath: $0).standardizedFileURL
            }
        }
        nonmutating set {
            defaults.set(newValue?.standardizedFileURL.path, forKey: Key.lastRoot)
        }
    }

    var gridSize: Double {
        get {
            guard defaults.object(forKey: Key.gridSize) != nil else { return 180 }
            return min(320, max(120, defaults.double(forKey: Key.gridSize)))
        }
        nonmutating set {
            defaults.set(min(320, max(120, newValue)), forKey: Key.gridSize)
        }
    }

    var bucket: MediaBucket? {
        get {
            defaults.string(forKey: Key.bucket).flatMap(MediaBucket.init(rawValue:))
        }
        nonmutating set {
            defaults.set(newValue?.rawValue, forKey: Key.bucket)
        }
    }

    var sort: MediaSort {
        get {
            defaults.string(forKey: Key.sort).flatMap(MediaSort.init(rawValue:)) ?? .name
        }
        nonmutating set {
            defaults.set(newValue.rawValue, forKey: Key.sort)
        }
    }

    var group: MediaGroup {
        get {
            defaults.string(forKey: Key.group).flatMap(MediaGroup.init(rawValue:)) ?? .none
        }
        nonmutating set {
            defaults.set(newValue.rawValue, forKey: Key.group)
        }
    }

    var includeIntermediates: Bool {
        get { defaults.bool(forKey: Key.includeIntermediates) }
        nonmutating set { defaults.set(newValue, forKey: Key.includeIntermediates) }
    }

    var inspectorVisible: Bool {
        get {
            guard defaults.object(forKey: Key.inspectorVisible) != nil else { return true }
            return defaults.bool(forKey: Key.inspectorVisible)
        }
        nonmutating set {
            defaults.set(newValue, forKey: Key.inspectorVisible)
        }
    }
}
