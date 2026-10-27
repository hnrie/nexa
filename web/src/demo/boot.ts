import { installDemoEnvironment } from "./environment";
// Nothing from the app may be imported before its storage and transports are isolated.
installDemoEnvironment(() => window.dispatchEvent(new Event("nexa-demo-account")));
void import("./DemoApp").then((m) => m.startDemo());
