"use client"

import { useForm } from "@tanstack/react-form"
import { useEffect, useRef } from "react"

export function CatalogSearch({
  onQuery,
  shown,
  total,
}: {
  onQuery: (query: string) => void
  shown: number
  total: number
}) {
  const input = useRef<HTMLInputElement>(null)

  const form = useForm({
    defaultValues: { q: "" },
    // Enter: jump to the first match.
    onSubmit: () => {
      document.querySelector<HTMLElement>(".catalogue__sheets .sheet-slot:not([hidden]) .sheet")?.scrollIntoView({ block: "start" })
    },
  })

  // "/" focuses the search from anywhere, unless you're already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable]")) return
      e.preventDefault()
      input.current?.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <form
      className="search"
      role="search"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="q" listeners={{ onChange: ({ value }) => onQuery(value) }}>
        {(field) => (
          <div className="search__box">
            <SearchIcon />
            <label htmlFor="catalog-search" className="sr-only">
              Search the catalogue
            </label>
            <input
              ref={input}
              id="catalog-search"
              className="search__input"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search styles, style no., SKU or colour"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && field.state.value) {
                  e.preventDefault()
                  field.handleChange("")
                }
              }}
              aria-describedby="catalog-search-count"
            />
            {field.state.value ? (
              <button
                type="button"
                className="search__clear"
                aria-label="Clear search"
                onClick={() => {
                  field.handleChange("")
                  input.current?.focus()
                }}
              >
                ×
              </button>
            ) : (
              <kbd className="search__kbd" aria-hidden>
                /
              </kbd>
            )}
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.q.trim()}>
        {(q) => (
          <p id="catalog-search-count" className="search__count" aria-live="polite">
            {q ? `${shown} of ${total} styles` : `${total} styles`}
          </p>
        )}
      </form.Subscribe>
    </form>
  )
}

function SearchIcon() {
  return (
    <svg className="search__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}
