import { useGameSettings } from "@/game/settings";
import { SettingsPanel } from "./SettingsPanel";

/** Shared settings sheet for menu screens; values persist via the same storage as gameplay. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, setSettings, saveError } = useGameSettings();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <SettingsPanel open settings={settings} onChange={setSettings} onClose={onClose} fnf saveError={saveError} />
    </div>
  );
}
