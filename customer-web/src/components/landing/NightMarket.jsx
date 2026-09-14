import React from "react";
import { Link } from "react-router-dom";
import "./styles/night.css";
import { useGoogleFont } from "./data";
import { landingContent } from "./content";
import { Wordmark, Nav, Lines, VisitDetails, PoweredBy, Photo } from "./parts";

/** Templates/Food-Peddler-Preview-02-Night — dark, late-night premium. */
export default function NightMarket({ landing, store, menuPath, onBookTable }) {
  useGoogleFont("family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700;800");
  const c = landingContent("night", landing, store);

  return (
    <div className="kkt-night">
      <header className="topbar section-shell">
        <div className="brand">
          <Wordmark c={c} plain />
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
              <Link className="button dark" to={menuPath}>{c.ctaText}</Link>
              <a className="button light" href="#menu">Explore menu</a>
            </div>
            <div className="hero-meta">
              {c.features.map((f, i) => (
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
          <div className="story-layout">
            <div className="story-copy-box">
              <p className="eyebrow">01 / The good stuff</p>
              <h2>
                {c.storyTitle}
                <br />
                <em>{c.storyAccent}</em>
              </h2>
              <p>{c.storyText}</p>
            </div>
            <div className="story-ticker">
              {c.features.map((f, i) => (
                <div key={i}>
                  <strong>0{i + 1}</strong>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {c.dishes.length ? (
          <section id="menu" className="menu section-shell">
            <div className="section-header inline">
              <div>
                <p className="eyebrow">02 / Bestsellers</p>
                <h2>
                  {c.menuTitle}
                  <br />
                  <em>{c.menuAccent}</em>
                </h2>
              </div>
              <Link to={menuPath}>View all</Link>
            </div>
            <div className="feature-grid">
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
            <p className="eyebrow">03 / Hungry now</p>
            <h2>{c.ctaTitle}</h2>
          </div>
          <Link className="button dark" to={menuPath}>Place order</Link>
        </section>

        <section id="visit" className="visit section-shell">
          <div className="visit-card">
            <div>
              <p className="eyebrow">04 / Visit</p>
              <h2>{c.visitTitle}</h2>
              <VisitDetails c={c} />
            </div>
            <div className="hours">
              <p className="mini-label">Open late</p>
              <p><Lines lines={c.hoursLines} /></p>
              <Link to={menuPath}>Order online →</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer section-shell">
        <div className="brand">
          <Wordmark c={c} plain />
        </div>
        <p>{c.footerTagline}</p>
        <PoweredBy />
      </footer>
    </div>
  );
}
