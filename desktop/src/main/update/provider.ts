import { GenericProvider } from "electron-updater/out/providers/GenericProvider";
import { parseUpdateInfo, type ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";
import type { AppUpdater } from "electron-updater/out/AppUpdater";
import type { CustomPublishOptions } from "builder-util-runtime";
import { fetchRelease } from "./releaseSignature";

/** Keep electron-updater's checksum/differential-download handling, while
 * authenticating the same manifest bytes its parser will consume. */
export class SignedReleaseProvider extends GenericProvider {
  private readonly feedBase: string;
  private readonly manifest: string;
  constructor(options: CustomPublishOptions, updater: AppUpdater, runtime: ProviderRuntimeOptions) {
    super({ provider: "generic", url: options.url }, updater, runtime);
    this.feedBase = options.url;
    this.manifest = runtime.platform === "win32" ? "signed-latest.yml" : "signed-latest-linux.yml";
  }
  override async getLatestVersion() {
    const body = await fetchRelease(this.feedBase, this.manifest);
    if (body === null) throw new Error("no update manifest is published");
    return parseUpdateInfo(body, this.manifest, new URL(this.manifest, this.feedBase));
  }
}
