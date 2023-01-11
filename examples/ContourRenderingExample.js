import React from 'react';
import { View2D } from '@vtk-viewport';
import vtkHttpDataSetReader from '@kitware/vtk.js/IO/Core/HttpDataSetReader';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';

class ContourRenderingExample extends React.Component {
  state = {
    volumes: [],
    contourRois: {},
  };

  async componentDidMount() {
    this.apis = [];

    const reader = vtkHttpDataSetReader.newInstance({
      fetchGzip: true,
    });
    const volumeActor = vtkVolume.newInstance();
    const volumeMapper = vtkVolumeMapper.newInstance();

    volumeActor.setMapper(volumeMapper);

    reader.setUrl('/headsq.vti', { loadData: true }).then(() => {
      const data = reader.getOutputData();
      volumeMapper.setInputData(data);

      const windowWidth = 1000;
      const windowCenter = 300 + 1024; // vti data - translate windowCenter
      const low = windowCenter - windowWidth / 2;
      const high = windowCenter + windowWidth / 2;
      const rgbTransferFunction = volumeActor
        .getProperty()
        .getRGBTransferFunction(0);
      rgbTransferFunction.setMappingRange(low, high);

      const testContourRois = this.createTestContourRois(data);

      this.setState({
        volumes: [volumeActor],
        contourRois: testContourRois,
      });
    });
  }

  createTestContourRois(data) {
    const roiParameters = [
      {
        id: 'body',
        color: [0, 1, 0],
        contourValue: 1024 - 100,
      },
      {
        id: 'bone',
        color: [0.88, 0.25, 0.28],
        contourValue: 1024 + 400,
      },
    ];

    const contourRois = {};
    roiParameters.forEach(paras => {
      const mCubes = vtkImageMarchingCubes.newInstance({
        contourValue: paras.contourValue,
      });
      mCubes.setInputData(data);
      mCubes.update();
      const polyData = mCubes.getOutputData();
      const transform = vtkMatrixBuilder
        .buildFromRadian()
        .identity()
        .rotateFromDirections([1, 0, 0, 0, 1, 0, 0, 0, 1], data.getDirection());
      transform.apply(polyData.getPoints().getData());
      contourRois[paras.id] = { polyData, color: paras.color };
    });

    return contourRois;
  }

  updateAllViewports = () => {
    Object.keys(this.apis).forEach(viewportIndex => {
      const api = this.apis[viewportIndex];

      api.genericRenderWindow.getRenderWindow().render();
    });
  };

  saveRenderWindow = viewportIndex => {
    return api => {
      this.apis[viewportIndex] = api;
      const apis = this.apis;

      this.apis.forEach((api, index) => {
        const renderWindow = api.genericRenderWindow.getRenderWindow();
        const iStyle = renderWindow.getInteractor().getInteractorStyle();
        if (iStyle.setApis && iStyle.setApiIndex) {
          iStyle.setApis(this.apis);
          iStyle.setApiIndex(index);
        }
      });

      window.apis = apis;
    };
  };

  render() {
    if (!this.state.volumes || !this.state.volumes.length) {
      return <h4>Loading...</h4>;
    }

    return (
      <React.Fragment>
        <div className="row">
          <div className="col-xs-12">
            <p>This example demonstrates contour rendering in 3D MPR.</p>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-6">
            <View2D
              volumes={this.state.volumes}
              contourRois={this.state.contourRois}
              onCreated={this.saveRenderWindow(0)}
            />
          </div>
        </div>
      </React.Fragment>
    );
  }
}

export default ContourRenderingExample;
