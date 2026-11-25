declare module "*?url" { const url: string; export default url; }
declare module "*?worker&url" { const url: string; export default url; }
interface ImportMeta { env: { MODE: string; PROD: boolean; MUMH5_PROXY_URL?: string } }
declare module "*.css" {}
