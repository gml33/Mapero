package app.mapero.wifi.overlays;

import android.content.Context;
import android.view.View;
import android.widget.TextView;

import app.mapero.wifi.R;

import org.osmdroid.views.MapView;
import org.osmdroid.views.overlay.Marker;
import org.osmdroid.views.overlay.infowindow.InfoWindow;

/**
 * Burbuja de información para los marcadores. Al tocar una red muestra su
 * nombre (SSID) y los detalles de señal. Se cierra con el botón X.
 */
public class WifiInfoWindow extends InfoWindow {

    private final TextView title;
    private final TextView description;

    public WifiInfoWindow(Context context, MapView mapView) {
        super(R.layout.bonuspack_bubble, mapView);
        title = mView.findViewById(R.id.bubble_title);
        description = mView.findViewById(R.id.bubble_description);

        View close = mView.findViewById(R.id.bubble_close);
        if (close != null) {
            close.setOnClickListener(v -> close());
        }
    }

    @Override
    public void onOpen(Object item) {
        if (!(item instanceof Marker)) return;
        Marker marker = (Marker) item;
        if (title != null) {
            title.setText(marker.getTitle());
        }
        if (description != null) {
            description.setText(marker.getSnippet());
        }
    }

    @Override
    public void onClose() {
        // No hace falta limpiar: se rellena en onOpen.
    }
}
