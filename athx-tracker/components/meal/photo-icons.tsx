/**
 * Small marks for the Library button: a pinwheel for Google Photos and a
 * flower for Apple Photos, so either phone's owner sees their own library.
 * Drawn here in their colours, not the companies' own artwork.
 */
type Mark = { className?: string };

export function GooglePhotosMark({ className }: Mark) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M12 12 L12 3 A4.5 4.5 0 0 0 12 12 Z" fill="#EA4335" />
      <path d="M12 12 L21 12 A4.5 4.5 0 0 0 12 12 Z" fill="#4285F4" />
      <path d="M12 12 L12 21 A4.5 4.5 0 0 0 12 12 Z" fill="#34A853" />
      <path d="M12 12 L3 12 A4.5 4.5 0 0 0 12 12 Z" fill="#FBBC04" />
    </svg>
  );
}

const PETALS = ["#F9A825", "#FDD835", "#7CB342", "#26A69A", "#42A5F5", "#7E57C2", "#EC407A", "#EF5350"];

export function ApplePhotosMark({ className }: Mark) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {PETALS.map((fill, index) => (
        <ellipse
          key={fill}
          cx="12"
          cy="7"
          rx="2.6"
          ry="5"
          fill={fill}
          opacity="0.85"
          transform={`rotate(${index * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}
