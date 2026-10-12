import { useEffect, useState } from 'react'

const MOBILE_BREAKPOINT = 768

export function useResponsive() {
  const getIsMobile = () => window.innerWidth < MOBILE_BREAKPOINT

  const [isMobile, setIsMobile] = useState(getIsMobile)

  useEffect(() => {
    const handleResize = () => setIsMobile(getIsMobile())

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isMobile
}
