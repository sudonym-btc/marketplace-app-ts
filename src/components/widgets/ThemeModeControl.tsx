import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'

import { useTheme, type ThemePreference } from '../../theme/theme'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui'

const themeOptions: {
  value: ThemePreference
  label: string
  Icon: typeof MonitorIcon
}[] = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
]

export function ThemeModeControl() {
  const { preference, resolvedTheme, setPreference } = useTheme()
  const CurrentIcon = themeOptions.find(option => option.value === preference)?.Icon ?? MonitorIcon

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <CurrentIcon className="size-4" aria-hidden />
          </span>
          <Select value={preference} onValueChange={value => setPreference(value as ThemePreference)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themeOptions.map(({ Icon, label, value }) => (
                <SelectItem key={value} value={value}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="m-0 text-sm text-muted-foreground">Resolved {resolvedTheme}</p>
      </CardContent>
    </Card>
  )
}
