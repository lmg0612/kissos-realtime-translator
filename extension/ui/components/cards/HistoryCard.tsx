interface Props {
  pin: string;
  expiresAt: string;
}

export default function HistoryCard({
  pin,
  expiresAt,
}: Props) {
  return (
    <>

      <div className="pinValue">
        {pin}
      </div>

      <div className="cardFooter">
        Expires {expiresAt}
      </div>
    </>
  );
}