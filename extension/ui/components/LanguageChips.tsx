import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "./LanguageChips.css";
import { LANGUAGES, PRIORITY_LANGUAGES } from "../constants/languages";

const MAX_SELECTED = 9;
const SORT_DELAY = 80;
const ROWS_PER_PAGE = 3;
const WHEEL_LOCK_MS = 200;

type Props = {
  value?: string[];
  onChange?: (languages: string[]) => void;
};

type Row = string[];
type Page = Row[];

function createBaseOrder() {
  const prioritySet = new Set(PRIORITY_LANGUAGES);

  const priority = PRIORITY_LANGUAGES.filter((lang) =>
    LANGUAGES.includes(lang)
  );

  const rest = LANGUAGES.filter((lang) => !prioritySet.has(lang)).sort((a, b) =>
    a.localeCompare(b)
  );

  return [...priority, ...rest];
}

function chunkRows(rows: Row[], size: number): Page[] {
  const pages: Page[] = [];

  for (let i = 0; i < rows.length; i += size) {
    pages.push(rows.slice(i, i + size));
  }

  return pages;
}

export default function LanguageChips({ value, onChange }: Props) {
  const [internalSelected, setInternalSelected] = useState<string[]>([]);
  const [pendingChip, setPendingChip] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<Page[]>([]);

  const selected = value ?? internalSelected;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const chipMeasureRefs = useRef(new Map<string, HTMLButtonElement>());

  const pageRef = useRef(0);
  const wheelLockRef = useRef(false);
  const wheelUnlockTimerRef = useRef<number | null>(null);

  const baseOrder = useMemo(() => createBaseOrder(), []);

  const visibleLanguages = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const selectedSet = new Set(selected);

    const selectedPart = selected.filter((lang) => {
      if (!keyword) return true;
      return lang.toLowerCase().includes(keyword);
    });

    const restPart = baseOrder.filter((lang) => {
      if (selectedSet.has(lang)) return false;
      if (!keyword) return true;
      return lang.toLowerCase().includes(keyword);
    });

    return [...selectedPart, ...restPart];
  }, [baseOrder, selected, query]);

  const updateSelected = (next: string[]) => {
    if (value === undefined) {
      setInternalSelected(next);
    }

    onChange?.(next);
  };

  const buildPagesFromMeasuredRows = useCallback(() => {
    const measureEl = measureRef.current;
    if (!measureEl) return;

    const rows: Row[] = [];
    let currentTop: number | null = null;
    let currentRow: Row = [];

    visibleLanguages.forEach((language) => {
      const chipEl = chipMeasureRefs.current.get(language);
      if (!chipEl) return;

      const top = Math.round(chipEl.offsetTop);

      if (currentTop === null) {
        currentTop = top;
        currentRow = [language];
        return;
      }

      if (Math.abs(top - currentTop) <= 2) {
        currentRow.push(language);
        return;
      }

      rows.push(currentRow);
      currentTop = top;
      currentRow = [language];
    });

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    const nextPages = chunkRows(rows, ROWS_PER_PAGE);
    setPages(nextPages);

    requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const maxPage = Math.max(0, nextPages.length - 1);

      if (pageRef.current > maxPage) {
        pageRef.current = maxPage;
        viewport.scrollTo({
          top: viewport.clientHeight * maxPage,
          behavior: "instant",
        });
      }
    });
  }, [visibleLanguages]);

  useLayoutEffect(() => {
    buildPagesFromMeasuredRows();
  }, [buildPagesFromMeasuredRows]);

  useEffect(() => {
    const measureEl = measureRef.current;
    if (!measureEl) return;

    const resizeObserver = new ResizeObserver(() => {
      buildPagesFromMeasuredRows();
    });

    resizeObserver.observe(measureEl);

    return () => {
      resizeObserver.disconnect();
    };
  }, [buildPagesFromMeasuredRows]);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const maxPage = Math.max(0, pages.length - 1);
    const safePage = Math.min(Math.max(page, 0), maxPage);

    pageRef.current = safePage;

    viewport.scrollTo({
      top: viewport.clientHeight * safePage,
      behavior,
    });
  }, [pages.length]);

  const syncPageFromScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const pageHeight = viewport.clientHeight;
    const maxPage = Math.max(0, pages.length - 1);

    const nextPage = Math.min(
      Math.max(Math.round(viewport.scrollTop / pageHeight), 0),
      maxPage
    );

    pageRef.current = nextPage;
  }, [pages.length]);

  const toggleLanguage = (language: string) => {
    const isSelected = selected.includes(language);

    if (!isSelected && selected.length >= MAX_SELECTED) return;

    setPendingChip(language);

    window.setTimeout(() => {
      if (isSelected) {
        updateSelected(selected.filter((item) => item !== language));
      } else {
        updateSelected([...selected, language]);
      }

      setPendingChip(null);
    }, SORT_DELAY);
  };

  const clearSearch = () => {
    setQuery("");
    setSearchMode(false);
    scrollToPage(0, "instant");
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.cancelable) return;

      event.preventDefault();

      if (Math.abs(event.deltaY) < 8) return;
      if (wheelLockRef.current) return;

      syncPageFromScroll();

      const direction = event.deltaY > 0 ? 1 : -1;
      const nextPage = pageRef.current + direction;

      const maxPage = Math.max(0, pages.length - 1);
      const safeNextPage = Math.min(Math.max(nextPage, 0), maxPage);

      if (safeNextPage === pageRef.current) return;

      wheelLockRef.current = true;
      scrollToPage(safeNextPage, "smooth");

      if (wheelUnlockTimerRef.current) {
        window.clearTimeout(wheelUnlockTimerRef.current);
      }

      wheelUnlockTimerRef.current = window.setTimeout(() => {
        wheelLockRef.current = false;
        syncPageFromScroll();
      }, WHEEL_LOCK_MS);
    };

    const handleScroll = () => {
      syncPageFromScroll();
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("scroll", handleScroll);

    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("scroll", handleScroll);

      if (wheelUnlockTimerRef.current) {
        window.clearTimeout(wheelUnlockTimerRef.current);
      }
    };
  }, [pages.length, scrollToPage, syncPageFromScroll]);

  useEffect(() => {
    requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const maxPage = Math.max(0, pages.length - 1);

      if (pageRef.current > maxPage) {
        scrollToPage(maxPage, "instant");
      }
    });
  }, [pages.length, scrollToPage]);

  return (
    <section className="language-panel">
      <header className="language-panel__header">
        <div className="language-panel__title-wrap">
          {searchMode ? (
            <>
              {!query && (
                <span className="language-panel__ghost">Language </span>
              )}

              <input
                autoFocus
                value={query}
                className="language-panel__search"
                onChange={(event) => {
                  setQuery(event.target.value);
                  scrollToPage(0, "instant");
                }}
                onBlur={() => {
                  if (!query.trim()) {
                    setSearchMode(false);
                  }
                }}
              />
            </>
          ) : (
            <h2 className="language-panel__title">Language </h2>
          )}
        </div>

        <button
          className="language-panel__search-btn"
          type="button"
          aria-label={searchMode ? "Close search" : "Search language"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (searchMode) {
              clearSearch();
            } else {
              setSearchMode(true);
            }
          }}
        >
          {searchMode ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M10.8 18.1C14.8317 18.1 18.1 14.8317 18.1 10.8C18.1 6.76832 14.8317 3.5 10.8 3.5C6.76832 3.5 3.5 6.76832 3.5 10.8C3.5 14.8317 6.76832 18.1 10.8 18.1Z"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M16.2 16.2L21 21"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
          
        </button>
      </header>

      <div ref={viewportRef} className="language-page-viewport">
        <div className="language-page-list">
          {pages.length > 0 ? (
            pages.map((page, pageIndex) => (
              <div className="language-page" key={pageIndex}>
                {page.map((row, rowIndex) => (
                  <div className="language-chip-row" key={rowIndex}>
                    {row.map((language) => {
                      const isSelected = selected.includes(language);
                      const isPending = pendingChip === language;

                      return (
                        <button
                          key={language}
                          type="button"
                          className={[
                            "language-chip",
                            isSelected ? "language-chip--selected" : "",
                            isPending ? "language-chip--pending" : "",
                          ].join(" ")}
                          onClick={() => toggleLanguage(language)}
                        >
                          {language}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="language-page">
              <div className="language-panel__empty">No languages found</div>
            </div>
          )}
        </div>
      </div>

      <div ref={measureRef} className="language-measure" aria-hidden="true">
        {visibleLanguages.map((language) => {
          const isSelected = selected.includes(language);
          const isPending = pendingChip === language;

          return (
            <button
              key={language}
              ref={(el) => {
                if (el) {
                  chipMeasureRefs.current.set(language, el);
                } else {
                  chipMeasureRefs.current.delete(language);
                }
              }}
              type="button"
              tabIndex={-1}
              className={[
                "language-chip",
                isSelected ? "language-chip--selected" : "",
                isPending ? "language-chip--pending" : "",
              ].join(" ")}
            >
              {language}
            </button>
          );
        })}
      </div>
{/* 
      <footer className="language-panel__footer">
          {selected.length} / {MAX_SELECTED}
      </footer> */}
    </section>
  );
}