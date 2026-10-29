package com.knotkitchen.mdm;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Small programmatic UI kit; the agent has only a handful of plain screens. */
final class Ui {
    static final int NAVY = Color.parseColor("#080F1F");
    static final int ORANGE = Color.parseColor("#F97316");
    static final int MUTED = Color.parseColor("#94A3B8");

    private Ui() {}

    static int dp(Context c, int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics());
    }

    static LinearLayout column(Context c, int bg) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(bg);
        int p = dp(c, 24);
        l.setPadding(p, p, p, p);
        return l;
    }

    static TextView text(Context c, String s, int sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(c, 6), 0, dp(c, 6));
        return t;
    }

    static Button button(Context c, String label, boolean primary) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTextColor(primary ? Color.WHITE : NAVY);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(c, 10));
        bg.setColor(primary ? ORANGE : Color.parseColor("#E2E8F0"));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(c, 300), dp(c, 52));
        lp.topMargin = dp(c, 10);
        b.setLayoutParams(lp);
        return b;
    }
}
