import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
if (process.platform !== "darwin") throw Error("Native iOS verification requires macOS/Xcode; use the iOS CI job");
const project = readdirSync("ios").find((n) => n.endsWith(".xcodeproj"));
if (!project) throw Error("Run Expo iOS prebuild and pod install first");
const scheme = project.slice(0, -".xcodeproj".length);
execFileSync("xcodebuild", ["-workspace", "ios/" + scheme + ".xcworkspace", "-scheme", scheme, "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-configuration", "Debug", "-derivedDataPath", "dist/ios-native", "CODE_SIGNING_ALLOWED=NO", "build"], { stdio: "inherit" });
