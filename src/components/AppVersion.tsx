export function AppVersion({ version }: { version: string | null }) {
  return <small className="app-version">{version ? `Fathom ${version}` : "Fathom"}</small>;
}
