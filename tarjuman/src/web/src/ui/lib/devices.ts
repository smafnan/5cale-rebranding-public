import type { AudioDevice } from '../../state/types';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Options for a device <select>: "System default" first, then every device. Before the
 * browser reveals device names the entries are numbered instead. A saved device that is
 * no longer plugged in stays selectable so the select never shows a wrong value.
 */
export function deviceOptions(devices: readonly AudioDevice[], selected: string, unnamed: string): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: 'System default' }];
  const seen = new Set<string>(['']);
  devices.forEach((device, index) => {
    if (seen.has(device.deviceId)) return;
    seen.add(device.deviceId);
    const name = device.label || `${unnamed} ${index + 1}`;
    options.push({ value: device.deviceId, label: device.virtual ? `${name} · virtual cable` : name });
  });
  if (!seen.has(selected)) options.push({ value: selected, label: 'Saved device (not connected)' });
  return options;
}
