import { Code2Icon } from 'lucide-react'

import { useCodeHints } from '../../codeHints/codeHints'
import { Card, CardContent, CardHeader, CardTitle, Checkbox, Field, FieldContent, FieldDescription, FieldTitle } from '../ui'

export function CodeHintsControl() {
  const { setShowCode, showCode } = useCodeHints()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Code hints</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field orientation="horizontal">
          <Checkbox
            id="show-code"
            checked={showCode}
            onCheckedChange={value => setShowCode(value === true)}
          />
          <FieldContent>
            <FieldTitle>
              <Code2Icon className="size-4 text-muted-foreground" aria-hidden />
              show_code
            </FieldTitle>
            <FieldDescription>
              Glass overlays show the marketplace SDK call used by each widget.
            </FieldDescription>
          </FieldContent>
        </Field>
      </CardContent>
    </Card>
  )
}
