import type { AnyFieldApi } from "@tanstack/react-form"
import type { InputHTMLAttributes } from "react"

type TextFieldProps = {
  field: AnyFieldApi
  label: string
  hint?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange" | "onBlur">

/** A labelled text input bound to a TanStack Form field. Errors show once the field is touched. */
export function TextField({ field, label, hint, id, ...input }: TextFieldProps) {
  const inputId = id ?? field.name
  const error = field.state.meta.isTouched ? field.state.meta.errors[0] : undefined
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label htmlFor={inputId} className="field__label">
        {label}
      </label>
      <input
        {...input}
        id={inputId}
        name={field.name}
        className="field__input"
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      {error ? (
        <p id={`${inputId}-error`} className="field__error">
          {String(error)}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export const required =
  (message: string) =>
  ({ value }: { value: string }) =>
    value.trim() ? undefined : message

export const validEmail = ({ value }: { value: string }) =>
  !value.trim() ? "Enter your email address" : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : "Enter a valid email address"

/** The platform counts bytes: å, ä and ö count as two. */
export const validPassword = ({ value }: { value: string }) => {
  const bytes = new TextEncoder().encode(value).length
  if (bytes < 6) return "At least 6 characters"
  if (bytes > 40) return "At most 40 characters (å, ä, ö count as two)"
  return undefined
}
