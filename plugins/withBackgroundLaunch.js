// Start React Native (and with it the pendant pipeline and the CoreBluetooth central) at app level
// when iOS launches the app in the background.
//
// Why: under the scene life cycle, ExpoAppSceneDelegate starts React Native only when a UI scene
// connects. When iOS kills wali in the background and relaunches it for a Bluetooth event (state
// restoration, restore id com.reedgrenager.mind.central), it may not connect a scene, so no JS
// runs, nobody re-creates the central manager, and the pendant falls back to its SD card until the
// user opens the app. Apple DTS: create the central at app level, never behind the UI.
//
// What: in application(_:didFinishLaunchingWithOptions:), start the React host without a view
// (RCTRootViewFactory.initializeReactHost) when the launch is a Bluetooth relaunch, or when we're
// still in the background with no host 0.5 s later. When a scene connects later, startReactNative
// reuses that host and only adds the surface. A normal foreground launch is unchanged (the scene
// creates the host first, so cold-start deep links keep their launch options).
//
// Release builds only: in the dev client, expo-dev-launcher decides which bundle to load. With
// expo-updates, the headless host loads the update expo-updates would launch (see HELPER).
const { withAppDelegate } = require("@expo/config-plugins");

const MARKER = "// wali: background-launch";

const CALL = `
    ${MARKER}
#if !DEBUG
    let bluetoothRelaunch = launchOptions?[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsBluetoothCentralsKey")] != nil
    // WALI_TEST_HEADLESS_START=1 (simctl/Xcode env only) runs the same path on a normal launch, so
    // it can be exercised in the simulator, where iOS never relaunches an app for Bluetooth.
    if bluetoothRelaunch || ProcessInfo.processInfo.environment["WALI_TEST_HEADLESS_START"] == "1" {
      Self.startReactWithoutScene(factory)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak factory] in
      guard let factory, UIApplication.shared.applicationState == .background else { return }
      Self.startReactWithoutScene(factory)
    }
#endif
`;

const HELPER = `
  ${MARKER}
  /// Start the React host (runs the JS bundle, which starts the pendant pipeline) without a view.
  /// No-op if a scene already started React Native: RCTRootViewFactory creates the host only if
  /// needed, and a later scene's startReactNative reuses it.
  static func startReactWithoutScene(_ factory: RCTReactNativeFactory) {
    let viewFactory = factory.rootViewFactory
    // expo-updates: run the same bundle a normal launch would (the newest downloaded update), not
    // the embedded one. Its startup picks the launch asset off the main thread, so we wait here on
    // main; a scene can't connect meanwhile, and when one does, ExpoUpdatesReactDelegateHandler
    // sees a started controller with a launch URL and reuses this host.
    AppController.initializeWithoutStarting()
    let updates = AppController.sharedInstance
    if updates.isActiveController {
      if !updates.isStarted { updates.start() }
      let deadline = Date().addingTimeInterval(5)
      while updates.launchAssetUrl() == nil && Date() < deadline { usleep(10_000) }
      if let url = updates.launchAssetUrl(),
        let configuration = viewFactory.value(forKey: "_configuration") as? RCTRootViewFactoryConfiguration {
        configuration.bundleURLBlock = { url }
      }
      // No URL in 5 s: start with the embedded bundle anyway; recording matters more.
    }
    // Release builds compile RCTDevMenuConfiguration out (RCT_DEV_MENU=0), so the factory's value is
    // nil and +defaultConfiguration returns nil too. Objective-C takes nil here (Expo passes it),
    // but Swift sees the parameter as non-optional and traps on a nil fallback: that crash-looped
    // wali on 2026-11-14. Call the method through its Objective-C implementation instead.
    typealias InitHost = @convention(c) (AnyObject, Selector, NSDictionary?, AnyObject?, AnyObject?) -> Void
    let sel = NSSelectorFromString("initializeReactHostWithLaunchOptions:bundleConfiguration:devMenuConfiguration:")
    guard viewFactory.responds(to: sel) else { return }
    let initHost = unsafeBitCast(viewFactory.method(for: sel), to: InitHost.self)
    initHost(viewFactory, sel, nil, factory.bundleConfiguration, factory.devMenuConfiguration)
  }
`;

function patch(src) {
  if (src.includes(MARKER)) return src;
  if (!src.includes("import EXUpdates")) src = src.replace("import React\n", "import React\ninternal import EXUpdates\n");
  const anchor = "reactNativeFactory = factory\n";
  if (!src.includes(anchor)) throw new Error("withBackgroundLaunch: AppDelegate anchor not found");
  src = src.replace(anchor, anchor + CALL);
  // Helper goes right before the end of the AppDelegate class (before ReactNativeDelegate).
  const cls = "\nclass ReactNativeDelegate";
  const i = src.indexOf(cls);
  if (i < 0) throw new Error("withBackgroundLaunch: ReactNativeDelegate not found");
  const close = src.lastIndexOf("}", i);
  return src.slice(0, close) + HELPER.trimEnd() + "\n" + src.slice(close);
}

module.exports = function withBackgroundLaunch(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") throw new Error("withBackgroundLaunch: expected a Swift AppDelegate");
    cfg.modResults.contents = patch(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.patch = patch;
