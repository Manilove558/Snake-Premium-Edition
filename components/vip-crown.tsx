"use client"
import { Crown } from "lucide-react"

/** The VIP crown shown next to a VIP player's name — same icon as the VIP pass in the Store. */
export function VipCrown({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return <Crown aria-label="VIP" className={`inline-block shrink-0 align-middle -mt-0.5 mr-1 text-amber-500 ${className}`} />
}
