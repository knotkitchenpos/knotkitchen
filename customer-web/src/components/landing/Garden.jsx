import React from "react";
import { Link } from "react-router-dom";
import "./styles/garden.css";
import { useGoogleFont } from "./data";
import { landingContent } from "./content";
import { Wordmark, Nav, Lines, VisitDetails, PoweredBy, Photo } from "./parts";

/** Templates/Food-Peddler-Preview-03-Garden — fresh greens, photo first. */
export default function Garden({ landing, store, menuPath, onBookTable }) {
  useGoogleFont("family=Libre+Baskerville:wght@400;700&family=Manrope:wght@400;500;600;700;800");
  const c = landingContent("garden", landing, store);
  const cardClass = ["card-a", "card-b", "card-c"];

  return (
    <div className="kkt-garden">
      <header className="topbar section-shell">
        <div className="brand">
          <Wordmark c={c} />
        </div>
        <Nav className="nav" ctaClass="nav-cta" menuPath={menuPath} onBookTable={onBookTable} labels={["Our story", "Menu", "Visit"]} />
      </header>

      <main>
        <section className="hero section-shell">
          <div className="hero-visual">
            <div className="card-badge">{c.heroBadge}</div>
            <Photo srcs={c.heroImages} alt={c.heroAlt} />
          </div>
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
              <a className="button secondary" href="#menu">View menu</a>
            </div>
          </div>
        </section>

        <section id="story" className="story section-shell">
          <div className="story-layout">
            <div>
              <p className="eyebrow">01 / Our story</p>
              <h2>
                {c.storyTitle}
                <br />
                <em>{c.storyAccent}</em>
              </h2>
            </div>
            <div className="story-copy">
              <p>{c.storyText}</p>
              <Link to={menuPath}>Explore the menu →</Link>
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

        {c.dishes.length ? (
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
              <Link to={menuPath}>See all</Link>
            </div>
            <div className="menu-grid">
              {c.dishes.map((d, i) => (
                <Link key={d.id} to={menuPath} className={`menu-card ${cardClass[i]}`}>
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
            <p className="eyebrow">03 / Ready when you are</p>
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
          <Wordmark c={c} />
        </div>
        <p>{c.footerTagline}</p>
        <PoweredBy />
      </footer>
    </div>
  );
}
