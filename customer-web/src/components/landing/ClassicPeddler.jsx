import React from "react";
import { Link } from "react-router-dom";
import "./styles/peddler.css";
import { useGoogleFont } from "./data";
import { landingContent } from "./content";
import { Wordmark, Lines, VisitDetails, PoweredBy, useMenuToggle, Photo } from "./parts";

/** Templates/Food-Peddler-Preview — dark hero, sun disc, rotated photo. */
export default function ClassicPeddler({ landing, store, menuPath, onBookTable }) {
  useGoogleFont("family=DM+Serif+Display:ital@0;1&family=Manrope:wght@400;500;600;700;800");
  const c = landingContent("peddler", landing, store);
  const menu = useMenuToggle();
  const [lead, ...rest] = c.dishes;

  return (
    <div className="kkt-peddler">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label={`${c.name} home`}>
          <Wordmark c={c} />
        </a>
        <button className="menu-toggle" type="button" aria-expanded={menu.open} aria-controls="site-nav" onClick={menu.toggle}>
          Menu <span aria-hidden="true">{menu.open ? "−" : "+"}</span>
        </button>
        <nav id="site-nav" className={`site-nav ${menu.open ? "is-open" : ""}`} aria-label="Main navigation">
          <a href="#story" onClick={menu.close}>Our story</a>
          <a href="#menu" onClick={menu.close}>Menu</a>
          <a href="#visit" onClick={menu.close}>Find us</a>
          {onBookTable ? (
            <button type="button" className="kkt-book" onClick={() => { menu.close(); onBookTable(); }}>
              Book a Table
            </button>
          ) : null}
          <Link className="nav-order" to={menuPath}>
            Order online <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <main id="top">
        <section className="hero section-pad">
          <div className="hero-copy reveal">
            <p className="kicker">{c.kicker}</p>
            <h1>
              {c.headline}
              <br />
              <em>{c.headlineAccent}</em>
            </h1>
            <p className="hero-intro">{c.lead}</p>
            <Link className="button button-light" to={menuPath}>
              {c.ctaText} <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="hero-art reveal">
            <div className="sun-disc" />
            <Link className="hero-image-frame" to={menuPath} aria-label={`Order from ${c.name}`}>
              <Photo srcs={c.heroImages} alt={c.heroAlt} />
            </Link>
            {c.heroNote ? <p className="scribble">{c.heroNote}</p> : null}
            <span className="hero-sticker">{c.heroBadge}</span>
          </div>
        </section>

        <section id="story" className="story section-pad">
          <div className="section-label">01 / The good stuff</div>
          <div className="story-grid">
            <h2>
              {c.storyTitle}
              <br />
              <em>{c.storyAccent}</em>
            </h2>
            <div className="story-copy">
              <p>{c.storyText}</p>
              <Link className="text-link" to={menuPath}>
                Meet the whole menu <span aria-hidden="true">→</span>
              </Link>
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
          <section id="menu" className="menu-section section-pad">
            <div className="section-heading">
              <div>
                <div className="section-label">02 / On the table</div>
                <h2>
                  {c.menuTitle} <em>{c.menuAccent}</em>
                </h2>
              </div>
              <Link className="text-link desktop-link" to={menuPath}>
                See all dishes <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="dish-grid">
              {[lead, ...rest].map((d, i) => (
                <Link key={d.id} className={`dish-card ${i === 0 ? "dish-card-large" : ""}`} to={menuPath}>
                  <div className="dish-image">
                    <Photo srcs={d.images} alt={d.name} />
                    <span className="dish-tag">{d.tag}</span>
                  </div>
                  <div className="dish-meta">
                    <h3>{d.name}</h3>
                    <span>{d.price}</span>
                  </div>
                  {d.text ? <p>{d.text}</p> : null}
                </Link>
              ))}
            </div>
            <Link className="text-link mobile-link" to={menuPath}>
              See all dishes <span aria-hidden="true">↗</span>
            </Link>
          </section>
        ) : null}

        <section className="order-band section-pad">
          <div>
            <div className="section-label">03 / Your next bite</div>
            <h2>{c.ctaTitle}</h2>
            {c.ctaLead ? <p>{c.ctaLead}</p> : null}
          </div>
          <Link className="button button-accent" to={menuPath}>
            Order from {c.name} <span aria-hidden="true">↗</span>
          </Link>
        </section>

        <section id="visit" className="visit section-pad">
          <div className="visit-card">
            <div>
              <div className="section-label">04 / Keep in touch</div>
              <h2>{c.visitTitle}</h2>
              <VisitDetails c={c} />
            </div>
            <div className="hours">
              <p className="eyebrow">Open for orders</p>
              <p>
                <Lines lines={c.hoursLines} />
              </p>
              <Link className="text-link" to={menuPath}>
                Order online <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="#top">
          <Wordmark c={c} />
        </a>
        <p>{c.footerTagline}</p>
        <PoweredBy className="footer-note" />
      </footer>
    </div>
  );
}
