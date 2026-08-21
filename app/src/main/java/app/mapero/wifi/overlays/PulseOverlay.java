package app.mapero.wifi.overlays;

import android.animation.Animator;
import android.animation.ValueAnimator;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Point;

import org.osmdroid.util.GeoPoint;
import org.osmdroid.views.MapView;
import org.osmdroid.views.overlay.Overlay;

/**
 * Anillo de pulso sutil que se expande y se desvanece sobre una posición.
 * Se usa para animar la aparición de un punto de acceso nuevo.
 */
public class PulseOverlay extends Overlay {

    private final MapView mapView;
    private final GeoPoint geoPoint;
    private final Paint paint;
    private final Point reusePoint = new Point();
    private final float density;
    private final float baseRadiusPx;
    private ValueAnimator animator;

    public PulseOverlay(MapView mapView, GeoPoint geoPoint, int color) {
        super(mapView.getContext());
        this.mapView = mapView;
        this.geoPoint = geoPoint;
        this.density = mapView.getContext().getResources().getDisplayMetrics().density;
        this.baseRadiusPx = 6 * density;

        this.paint = new Paint();
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3 * density);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(color);
        paint.setAntiAlias(true);
    }

    public void start() {
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(1200);
        animator.addUpdateListener(a -> mapView.invalidate());
        animator.addListener(new Animator.AnimatorListener() {
            @Override public void onAnimationStart(Animator a) { }

            @Override public void onAnimationEnd(Animator a) {
                mapView.getOverlays().remove(PulseOverlay.this);
                mapView.invalidate();
            }

            @Override public void onAnimationCancel(Animator a) {
                mapView.getOverlays().remove(PulseOverlay.this);
            }

            @Override public void onAnimationRepeat(Animator a) { }
        });
        animator.start();
    }

    @Override
    public void draw(Canvas c, MapView mv, boolean shadow) {
        if (shadow || animator == null) return;
        float t = animator.getAnimatedFraction();
        if (t <= 0f) return;

        Point p = mv.getProjection().toPixels(geoPoint, reusePoint);

        // Anillo principal
        float radiusMain = baseRadiusPx + t * (60 * density);
        paint.setAlpha((int) (200 * (1 - t)));
        c.drawCircle(p.x, p.y, radiusMain, paint);

        // Anillo secundario, ligeramente desfasado para un efecto más orgánico
        float t2 = Math.max(0f, (t - 0.5f) * 2f);
        float radiusSec = baseRadiusPx + t2 * (80 * density);
        paint.setAlpha((int) (150 * (1 - t2)));
        c.drawCircle(p.x, p.y, radiusSec, paint);
    }
}
