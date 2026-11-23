// Minimal typings for screenshot-desktop (the package ships without its own declarations).
declare module "screenshot-desktop" {
  type DisplayId = string | number;
  type ImageFormat = "png" | "jpg";

  interface Display {
    id: DisplayId;
    name: string;
    [key: string]: unknown;
  }

  interface ScreenshotOptions {
    format?: ImageFormat;
    screen?: DisplayId;
    linuxLibrary?: "scrot" | "imagemagick";
  }

  interface Screenshot {
    (options?: ScreenshotOptions): Promise<Buffer>;
    (options: ScreenshotOptions & { filename: string }): Promise<string>;
    listDisplays(): Promise<Display[]>;
    all(): Promise<Buffer[]>;
  }

  const screenshot: Screenshot;
  export default screenshot;
}
