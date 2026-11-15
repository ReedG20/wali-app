// App entry. The pendant pipeline starts when the JS bundle loads, not when a screen mounts: when iOS
// relaunches wali in the background for a Bluetooth event, React Native may run with no UI scene
// and no React tree (see plugins/withBackgroundLaunch.js). startPipeline() is idempotent.
import "./src/lib/boot";
import "expo-router/entry";
