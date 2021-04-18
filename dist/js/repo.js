const initialThreshold = $("#threshold-value").val();
onThresholdChange(initialThreshold);

$("#arc-slider").roundSlider({
    // sliderType: "min-range",
    circleShape: "custom-quarter",
    animation: false,
    // svgMode: true,
    value: initialThreshold,
    startAngle: 45,
    showTooltip: false,
    radius: 350,
    width: 10,
    handleSize: "+20",
    keyboardAction: false,
    lineCap: "round",
    step: 1,
});

$("#arc-slider").on("update", e => onThresholdChange(e.value));

function onThresholdChange(t) {
  t = Number(t);
  $("#threshold-value").val(t);
  $("#threshold-perc").text(t);
  const name = t < 20
      ? "Highest quantity"
      : t < 40
          ? "High quantity"
          : t < 60
              ? "Balanced"
              : t < 80
                  ? "High quality"
                  : "Highest quality";
  $("#threshold-text").text(name);

  $("#class-prob-perc").text("" + Math.floor(100 * (1 - Math.pow(t / 100, 2))) + "%");
  $("#misclass-prob-perc").text("" + Math.floor(100 * (1 - (t / 100 + 4) / 5)) + "%");
}

$('input[name=arc-slider]').remove();
