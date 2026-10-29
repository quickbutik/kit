import { formatMoney } from "@quickbutik/kit"

export function money(minor: number, currency = "SEK"): string {
  return formatMoney(minor, currency, { locale: "sv-SE" })
}
