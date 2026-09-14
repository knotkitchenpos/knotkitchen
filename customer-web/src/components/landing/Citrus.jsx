import React from "react";
import { Link } from "react-router-dom";
import "./styles/citrus.css";
import { useGoogleFont } from "./data";
import { landingContent } from "./content";
import { Wordmark, Nav, Lines, VisitDetails, PoweredBy } from "./parts";

/** Templates/Food-Peddler-Preview-01-Citrus — warm cream, rounded cards. */
export default function Citrus({ landing, store, menuPath, onBookTable }) {
  useGoogleFont("family=DM+Serif+Display:ital@0;1&family=Manrope:wght@400;500;600;700;800");
  const c = landingContent("citrus", landing, store);
  const [highlight, ...small] = c.dishes;

  return (
    <div className="kkt-citrus">
      <header className="topbar section-shell">
        <div className="brand" aria-label={`${c.name} home`}>
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
              <a className="button secondary" href="#menu">See favourites</a>
            </div>
            <div className="mini-stats">
              {c.features.map((f, i) => (
                <span key={i}>
                  <strong>0{i + 1}</strong> {f}
                </span>
              ))}
            </div>
          </div>
          <div className="hero-visual">
            <div className="badge">{c.heroBadge}</div>
            <img src={c.heroImage} alt={c.heroAlt} />
          </div>
        </section>

        <section id="story" className="story section-shell">
          <div className="story-intro">
            <p className="eyebrow">01 / The good stuff</p>
            <h2>
              {c.storyTitle}
              <br />
              <em>{c.storyAccent}</em>
            </h2>
          </div>
          <div className="story-grid">
            <p>{c.storyText}</p>
            <div className="story-panel">
              <span>{c.storyPanelLabel}</span>
              <strong>{c.storyPanelText}</strong>
            </div>
          </div>
          <div className="feature-strip">
            {c.features.map((f, i) => (
              <div key={i}>
                <strong>0{i + 1}</strong>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </section>

        {highlight ? (
          <section id="menu" className="menu section-shell">
            <div className="section-header inline">
              <div>
                <p className="eyebrow">02 / Favourites</p>
                <h2>
                  {c.menuTitle}
                  <br />
                  <em>{c.menuAccent}</em>
                </h2>
              </div>
              <Link to={menuPath}>See all dishes</Link>
            </div>
            <div className="feature-layout">
              <Link to={menuPath} className="menu-card highlight">
                <img src={highlight.image} alt={highlight.name} />
                <div className="card-copy">
                  <div className="card-topline"><span className="tag">{highlight.tag}</span><span>{highlight.price}</span></div>
                  <h3>{highlight.name}</h3>
                  {highlight.text ? <p>{highlight.text}</p> : null}
                </div>
              </Link>
              <div className="menu-stack">
                {small.map((d) => (
                  <Link key={d.id} to={menuPath} className="menu-card small">
                    <img src={d.image} alt={d.name} />
                    <div className="card-copy">
                      <div className="card-topline"><span className="tag">{d.tag}</span><span>{d.price}</span></div>
                      <h3>{d.name}</h3>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="cta section-shell">
          <div>
            <p className="eyebrow">03 / Your next bite</p>
            <h2>{c.ctaTitle}</h2>
          </div>
          <Link className="button primary" to={menuPath}>Order from {c.name}</Link>
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
        <PoweredBy />
      </footer>
    </div>
  );
}
