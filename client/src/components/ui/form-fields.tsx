import * as React from 'react'
import { useFormContext, Controller, ControllerProps, FieldPath, FieldValues } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ============================================================================
// Form Field Wrapper with Error Display
// ============================================================================

interface FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> extends Omit<ControllerProps<TFieldValues, TName>, 'render'> {
  label?: string
  description?: string
  children: (field: {
    value: unknown
    onChange: (...event: unknown[]) => void
    onBlur: () => void
    name: TName
    ref: React.Ref<unknown>
    inputProps: {
      id: string
      'aria-invalid': boolean
      'aria-describedby'?: string
    }
  }) => React.ReactNode
}

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({ name, label, description, children, ...props }: FormFieldProps<TFieldValues, TName>) {
  const { control, formState: { errors } } = useFormContext<TFieldValues>()
  const generatedId = React.useId()
  const inputId = `${String(name).replace(/\./g, '-')}-${generatedId}`
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = `${inputId}-error`
  
  // Get nested error
  const error = name.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, errors) as { message?: string } | undefined

  const describedBy = [error?.message ? errorId : undefined, !error?.message ? descriptionId : undefined]
    .filter(Boolean)
    .join(' ') || undefined

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={inputId} className={cn(error && 'text-destructive')}>
          {label}
        </Label>
      )}
      <Controller
        name={name}
        control={control}
        {...props}
        render={({ field }) => <>{children({
          ...field,
          inputProps: {
            id: inputId,
            'aria-invalid': Boolean(error),
            'aria-describedby': describedBy,
          },
        })}</>}
      />
      {description && !error && (
        <p id={descriptionId} className="text-sm text-muted-foreground">{description}</p>
      )}
      {error?.message && (
        <p id={errorId} aria-live="polite" className="text-sm text-destructive">{error.message}</p>
      )}
    </div>
  )
}

// ============================================================================
// Pre-built Form Input Components
// ============================================================================

interface FormInputProps {
  name: string
  label?: string
  description?: string
  type?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function FormInput({ 
  name, 
  label, 
  description, 
  type = 'text',
  placeholder,
  className,
  disabled 
}: FormInputProps) {
  const { register, formState: { errors } } = useFormContext()
  const generatedId = React.useId()
  const inputId = `${name.replace(/\./g, '-')}-${generatedId}`
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = `${inputId}-error`
  
  const error = name.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, errors) as { message?: string } | undefined

  const describedBy = [error?.message ? errorId : undefined, !error?.message ? descriptionId : undefined]
    .filter(Boolean)
    .join(' ') || undefined

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={inputId} className={cn(error && 'text-destructive')}>
          {label}
        </Label>
      )}
      <Input
        id={inputId}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(error && 'border-destructive', className)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        {...register(name, { valueAsNumber: type === 'number' })}
      />
      {description && !error && (
        <p id={descriptionId} className="text-sm text-muted-foreground">{description}</p>
      )}
      {error?.message && (
        <p id={errorId} aria-live="polite" className="text-sm text-destructive">{error.message}</p>
      )}
    </div>
  )
}

// ============================================================================
// Form Submit Button with Loading State
// ============================================================================

interface FormSubmitButtonProps {
  children: React.ReactNode
  isLoading?: boolean
  loadingText?: string
  className?: string
  disabled?: boolean
}

export function FormSubmitButton({
  children,
  isLoading,
  loadingText = 'Saving...',
  className,
  disabled,
}: FormSubmitButtonProps) {
  const { formState: { isSubmitting } } = useFormContext()
  const loading = isLoading ?? isSubmitting

  return (
    <Button
      type="submit"
      disabled={loading || disabled}
      className={className}
    >
      {loading ? loadingText : children}
    </Button>
  )
}

// ============================================================================
// Form Error Summary (shows all errors at once)
// ============================================================================

export function FormErrorSummary() {
  const { formState: { errors } } = useFormContext()
  
  const errorMessages = Object.entries(errors)
    .filter(([, error]) => error?.message)
    .map(([field, error]) => ({
      field,
      message: (error as { message?: string })?.message || 'Invalid',
    }))

  if (errorMessages.length === 0) return null

  return (
    <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
      <p className="text-sm font-medium text-destructive mb-1">Please fix the following errors:</p>
      <ul className="text-sm text-destructive list-disc list-inside">
        {errorMessages.map(({ field, message }) => (
          <li key={field}>{message}</li>
        ))}
      </ul>
    </div>
  )
}
