import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { IconButton } from './ui';

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <IconButton label={`Switch to ${next} mode`} onClick={toggle}>
      {theme === 'dark' ? (
        <Sun className="size-5" aria-hidden />
      ) : (
        <Moon className="size-5" aria-hidden />
      )}
    </IconButton>
  );
}
