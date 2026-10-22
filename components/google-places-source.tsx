"use client";
// A fixed source label replaces the retired provider switch.
export function GooglePlacesSource() {
  return (
    <div className="inline-info">
      <span>
        <strong>Official Google Places</strong>
        <p>
          Business searches use Google Places API (New). Configure the server
          API key before starting collection.
        </p>
      </span>
    </div>
  );
}
