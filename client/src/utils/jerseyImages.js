// src/utils/jerseyImages.js

// Premier League 23/24 Season Jersey URLs using local assets
export const getJerseyImage = (teamShortName) => {
    const jerseyUrls = {
      ARS: "/assets/jerseys/arsenal.png",
      AVL: "/assets/jerseys/aston-villa.png",
      BHA: "/assets/jerseys/brighton.png",
      BOU: "/assets/jerseys/bournemouth.png",
      BRE: "/assets/jerseys/brentford.png",
      LEI: "/assets/jerseys/leicester.png",
      CHE: "/assets/jerseys/chelsea.png",
      CRY: "/assets/jerseys/crystal-palace.png",
      EVE: "/assets/jerseys/everton.png",
      FUL: "/assets/jerseys/fulham.png",
      LIV: "/assets/jerseys/liverpool.png",
      SOU: "/assets/jerseys/southampton.png",
      MCI: "/assets/jerseys/man-city.png",
      MUN: "/assets/jerseys/man-utd.png",
      NEW: "/assets/jerseys/newcastle.png",
      NFO: "/assets/jerseys/nottingham.png",
      IPS: "/assets/jerseys/ipswich.png",
      TOT: "/assets/jerseys/tottenham.png",
      WHU: "/assets/jerseys/west-ham.png",
      WOL: "/assets/jerseys/wolves.png"
    };
  
    return jerseyUrls[teamShortName] || "/assets/jerseys/default.png";
  };
  
  // Function to handle image loading errors
  export const handleJerseyError = (event) => {
    event.target.src = "/assets/jerseys/default.png";
  };