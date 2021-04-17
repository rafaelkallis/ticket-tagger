$("#arc-slider").roundSlider({
    // sliderType: "min-range",
    circleShape: "custom-quarter",
    animation: false,
    // svgMode: true,
    value: $("#threshold-slider").val(),
    startAngle: 45,
    showTooltip: false,
    radius: 350,
    width: 10,
    handleSize: "+20",
    keyboardAction: false,
    lineCap: "round",
    step: 1,
});

$("#arc-slider").on("update", function (e) {
    $("#threshold-slider").val(e.value);
    const label = e.value < 20
        ? "highest quantity"
        : e.value < 40
            ? "high quantity"
            : e.value < 60
                ? "balanced"
                : e.value < 80
                    ? "high quality"
                    : "highest quality";
    $("#threshold-name").text(label);
});

$('input[name=arc-slider]').remove();
