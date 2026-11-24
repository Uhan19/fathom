export function AppVersion({ version }: { version: string | null }) {
  return <small className="app-version" data-part="app-version">{version ? `Fathom ${version}` : "Fathom"}</small>;
}
