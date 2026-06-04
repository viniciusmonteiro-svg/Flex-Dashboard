declare module 'dom-to-image-more' {
  interface DomToImageOptions {
    width?: number;
    height?: number;
    pixelRatio?: number;
    bgcolor?: string;
    style?: Record<string, string>;
    filter?: (node: HTMLElement) => boolean;
  }

  interface DomToImageMore {
    toBlob(node: HTMLElement, options?: DomToImageOptions): Promise<Blob>;
    toPng(node: HTMLElement, options?: DomToImageOptions): Promise<string>;
    toSvg(node: HTMLElement, options?: DomToImageOptions): Promise<string>;
  }

  const domtoimage: DomToImageMore;
  export default domtoimage;
}