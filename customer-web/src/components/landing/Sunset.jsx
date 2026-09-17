import React from "react";
import { Link } from "react-router-dom";
import "./styles/sunset.css";
import { useGoogleFont } from "./data";
import { landingContent } from "./content";
import { Wordmark, Nav, Lines, VisitDetails, PoweredBy, Photo, LegalLinks } from "./parts";

/** Templates/Food-Peddler-Preview-04-Sunset — warm peach, playful serif. */
export default function Sunset({ landing, store, menuPath, onBookTable }) {
  useGoogleFont("family=Playfair+Display:wght@600;700;800&family=Manrope:wght@400;500;600;700;800");
  const c = landingContent("sunset", landing, store);

  return (
    <div className="kkt-sunset">
      <header className="topbar section-shell">
        <div className="brand">
          <Wordmark c={c} markClass="brand-mark" />
        </div>
        <Nav className="nav" ctaClass="nav-cta" menuPath={menuPath} onBookTable={onBookTable} />
      </header>

      <main>
        <section className="hero section-shell">
          <div className="hero-copy">
            <p className="eyebrow">{c.kicker}</p>
            <h1>
              {c.headline}
              <br />
              <em>{c.headlineAccent}</em>
            </h1>
            <p className="lead">{c.lead}</p>
            <div className="hero-actions">
              <Link className="button primary" to={menuPath}>{c.ctaText}</Link>
              <a className="button secondary" href="#menu">Best picks</a>
            </div>
            <div className="hero-badges">
              {c.features.slice(0, 2).map((f, i) => (
                <span key={i}>{f}</span>
              ))}
            </div>
          </div>
          <div className="hero-visual">
            <div className="floating-tag">{c.heroBadge}</div>
            <Photo srcs={c.heroImages} alt={c.heroAlt} />
          </div>
        </section>

        <section id="story" className="story section-shell">
          <div className="story-shell">
            <div className="story-card large">
              <p className="eyebrow">01 / Good food</p>
              <h2>
                {c.storyTitle}
                <br />
                <em>{c.storyAccent}</em>
              </h2>
              <p>{c.storyText}</p>
            </div>
            <div className="story-card small">
              {c.features.map((f, i) => (
                <React.Fragment key={i}>
                  <strong>0{i + 1}</strong>
                  <span>{f}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {c.dishes.length ? (
          <section id="menu" className="menu section-shell">
            <div className="section-header inline">
              <div>
                <p className="eyebrow">02 / Menu</p>
                <h2>
                  {c.menuTitle}
                  <br />
                  <em>{c.menuAccent}</em>
                </h2>
              </div>
              <Link to={menuPath}>Order now</Link>
            </div>
            <div className="menu-row">
              {c.dishes.map((d, i) => (
                <Link key={d.id} to={menuPath} className={`menu-card ${i === 0 ? "wide" : "compact"}`}>
                  <Photo srcs={d.images} alt={d.name} />
                  <div className="card-copy">
                    <div className="card-topline"><span className="tag">{d.tag}</span><span>{d.price}</span></div>
                    <h3>{d.name}</h3>
                    {i === 0 && d.text ? <p>{d.text}</p> : null}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="cta section-shell">
          <div>
            <p className="eyebrow">03 / Craving time</p>
            <h2>{c.ctaTitle}</h2>
          </div>
          <Link className="button primary" to={menuPath}>Order now</Link>
        </section>

        <section id="visit" className="visit section-shell">
          <div className="visit-card">
            <div>
              <p className="eyebrow">04 / Visit</p>
              <h2>{c.visitTitle}</h2>
              <VisitDetails c={c} />
            </div>
            <div className="hours">
              <p className="mini-label">Open daily</p>
              <p><Lines lines={c.hoursLines} /></p>
              <Link to={menuPath}>Order online →</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer section-shell">
        <div className="brand">
          <Wordmark c={c} markClass="brand-mark" />
        </div>
        <p>{c.footerTagline}</p>
        <LegalLinks fssai={c.fssai} />
        <PoweredBy />
      </footer>
    </div>
  );
}
