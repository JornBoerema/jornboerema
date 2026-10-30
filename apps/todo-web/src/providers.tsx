import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MotionConfig } from "motion/react"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15000 } },
      })
  )
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster position="bottom-right" closeButton />
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
