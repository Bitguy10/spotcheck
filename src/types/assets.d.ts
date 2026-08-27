/** Static image assets resolve to bundler-managed URIs at runtime. */
declare module '*.jpg' {
  const src: number;
  export default src;
}
declare module '*.jpeg' {
  const src: number;
  export default src;
}
declare module '*.png' {
  const src: number;
  export default src;
}
