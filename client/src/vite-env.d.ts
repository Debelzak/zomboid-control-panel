/// <reference types="vite/client" />

declare const __PANEL_VERSION__: string;

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.svg' {
  const content: string;
  export default content;
}
