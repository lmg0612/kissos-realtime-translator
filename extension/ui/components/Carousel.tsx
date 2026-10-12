import { motion } from "framer-motion";

import { UI } from "../constants/ui";

import type {
  CurrentSession,
  HistorySession,
} from "../types/session";

import CurrentCard from "./cards/CurrentCard";
import HistoryCard from "./cards/HistoryCard";
import PlaceholderCard from "./cards/PlaceholderCard";

import "./Carousel.css";

interface Props {
  current: CurrentSession;
  history: HistorySession[];

  activeIndex: number;

  onSelect: (index: number) => void;
}

export default function Carousel({
  current,
  history,
  activeIndex,
  onSelect,
}: Props) {
  const viewportWidth =
    UI.POPUP_WIDTH - 24;

  const cardWidth =
    viewportWidth *
    UI.CAROUSEL.CARD_RATIO;

  const gap = UI.CAROUSEL.GAP;
  const margin = 4; // Matching CSS margin: 4px
  const cardFullWidth = cardWidth + margin * 2;

  const cards = [
    { type: "current" as const },
    ...(history.length === 0
      ? [{ type: "placeholder" as const }]
      : history.map((item) => ({ type: "history" as const, ...item }))),
  ];

  const trackWidth =
    cards.length * cardFullWidth + (cards.length - 1) * gap;

  // Center of the viewport
  const centerPoint = viewportWidth / 2;
  // Center of the full card (including its margins)
  const cardCenter = cardFullWidth / 2;

  const targetX =
    centerPoint -
    cardCenter -
    activeIndex * (cardFullWidth + gap);

  const minX = viewportWidth - trackWidth;

  const x = Math.min(0, Math.max(minX, targetX));

  return (
    <div className="carouselViewport">
      <motion.div
        className="carouselTrack"
        animate={{ x }}
        transition={{
          type: "spring",
          ...UI.CAROUSEL.SPRING,
        }}
        style={{
          gap,
          width: trackWidth,
        }}
      >
        {cards.map((card, index) => {
          const active =
            index === activeIndex;

          const handleCardClick = () => {
            if (active) {
              // Get the pin based on card type
              let pin = "";
              if (card.type === "current") {
                pin = current.pin || "";
              } else if (card.type === "history") {
                pin = card.pin;
              }

              if (pin) {
                window.open(`http://<SERVER_HOST>/session/${pin}`, "_blank");
              }
            } else {
              onSelect(index);
            }
          };

          const commonProps = {
            className: `carouselCard ${
              active ? "active" : ""
            }`,

            style: {
              width: cardWidth,
            },

            onClick: handleCardClick,
          };

          if (
            card.type === "current"
          ) {
            return (
              <button
                key="current"
                {...commonProps}
              >
                <CurrentCard
                  pin={current.pin}
                  status={
                    current.status
                  }
                  lastError={current.lastError}
                />
              </button>
            );
          }

          if (
            card.type ===
            "placeholder"
          ) {
            return (
              <button
                key="placeholder"
                {...commonProps}
              >
                <PlaceholderCard />
              </button>
            );
          }

          return (
            <motion.button
              key={card.id}
              {...commonProps}
              transition={{
                duration: 0.25,
              }}
            >
              <HistoryCard
                pin={card.pin}
                expiresAt={
                  card.expiresAt
                }
              />
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
